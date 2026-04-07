package com.tutien.pixel.services;

import com.tutien.pixel.entities.dtos.PortalDto;
import com.tutien.pixel.entities.enums.directEnum;
import com.tutien.pixel.entities.portalEntity;
import com.tutien.pixel.entities.worldEntity;
import com.tutien.pixel.repositories.PortalRepository;
import com.tutien.pixel.repositories.iRepositories.IGenericService;
import com.tutien.pixel.utils.maps.MapUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.bind.annotation.RequestParam;
import tools.jackson.databind.ObjectMapper;

import java.util.List;
import java.util.Optional;

@Service
public class PortalService implements IGenericService<portalEntity, Integer> {
    @Autowired
    private WorldService worldService;
    @Autowired
    private PortalRepository portalRepository;

    @Autowired
    private MapUtils mapUtils;
    @Autowired
    private ObjectMapper objectMapper;

    @Override
    public List<portalEntity> findAll() {
        return portalRepository.findAll();
    }

    @Override
    public Optional<portalEntity> findById(Integer id) {
        return portalRepository.findById(id);
    }

    @Override
    public Optional<portalEntity> findByCode(String code) {
        return portalRepository.findByCode(code);
    }

    @Override
    public portalEntity save(portalEntity entity) {
        // Đảm bảo quan hệ 2 chiều được thiết lập trước khi lưu
        Optional<worldEntity> world = worldService.findByCode(entity.getMapCode());
        Optional<worldEntity> worldDen = worldService.findByCode(entity.getDenMap());
        if (world.isEmpty() && worldDen.isEmpty()) {
            throw new RuntimeException("Thieu du lieu map");
        }
        if (world == worldDen) {
            throw new RuntimeException("Map den khong duoc trung map hien tai");
        }
        if (world.isPresent() && worldDen.isPresent()) {
            switch (entity.getDir()) {
                case D -> {
                    // cong trong map
                    entity.setX(mapUtils.randInt(world.get().getW() / 3, Math.round(world.get().getW() / 1.5F)));
                    entity.setY(world.get().getH() - 2);
                    // cong map den
                    entity.setToX(mapUtils.randInt(worldDen.get().getW() / 3, Math.round(worldDen.get().getW() / 1.5F)));
                    entity.setToY(2);
                }
                case U -> {
                    entity.setX(mapUtils.randInt(world.get().getW() / 3, Math.round(world.get().getW() / 1.5F)));
                    entity.setY(2);
                    // cong map den
                    entity.setToX(mapUtils.randInt(worldDen.get().getW() / 3, Math.round(worldDen.get().getW() / 1.5F)));
                    entity.setToY(worldDen.get().getH() - 2);
                }
                case L -> {
                    entity.setY(mapUtils.randInt(world.get().getH() / 3, Math.round(world.get().getH() / 1.5F)));
                    entity.setX(2);
                    // cong map den
                    entity.setToY(mapUtils.randInt(worldDen.get().getW() / 3, Math.round(worldDen.get().getW() / 1.5F)));
                    entity.setToX(worldDen.get().getW() - 2);
                }
                case R -> {
                    entity.setY(mapUtils.randInt(world.get().getH() / 3, Math.round(world.get().getH() / 1.5F)));
                    entity.setX(world.get().getW() - 2);
                    // cong map den
                    entity.setToY(mapUtils.randInt(worldDen.get().getW() / 3, Math.round(worldDen.get().getW() / 1.5F)));
                    entity.setToX(2);
                }
            }
            entity.setMapName(worldDen.get().getTenMap());
            return portalRepository.save(entity);
        }
        return null;
    }

    @Override
    public portalEntity update(Integer id, portalEntity newDetails) {
        Optional<portalEntity> exists = portalRepository.findById(id);
        if (exists.isPresent()) {
            exists.get().setCode(newDetails.getCode());
            exists.get().setDir(newDetails.getDir());
            exists.get().setMapName(newDetails.getMapName());

//            exists.get().setDenMap(newDetails.getDenMap());
//            exists.get().setX(newDetails.getX());
//            exists.get().setY(newDetails.getY());
//            exists.get().setToX(newDetails.getToX());
//            exists.get().setToY(newDetails.getToY());
//            exists.get().setMapCode(newDetails.getMapCode());
            return portalRepository.save(exists.get());

        }
        throw new RuntimeException("Không tìm thấy Map với ID: " + id);
    }


    @Override
    public void delete(Integer id) {
        portalRepository.deleteById(id);
    }
}
