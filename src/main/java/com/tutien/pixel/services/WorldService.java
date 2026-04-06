package com.tutien.pixel.services;

import com.tutien.pixel.entities.worldEntity;
import com.tutien.pixel.repositories.WorldRepository;
import com.tutien.pixel.repositories.iRepositories.IGenericService;
import com.tutien.pixel.utils.maps.MapUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

import java.util.List;
import java.util.Optional;

@Service
public class WorldService implements IGenericService<worldEntity, Integer> {

    @Autowired
    private WorldRepository worldRepository;
    @Autowired
    private MapUtils mapUtils;
    @Autowired
    private ObjectMapper objectMapper;

    @Override
    public List<worldEntity> findAll() {
        return worldRepository.findAll();
    }

    @Override
    public Optional<worldEntity> findById(Integer id) {
        return worldRepository.findById(id);
    }

    @Override
    public Optional<worldEntity> findByCode(String code) {
        return worldRepository.findByCode(code);
    }

    @Override
    public worldEntity save(worldEntity entity) {
        // Đảm bảo quan hệ 2 chiều được thiết lập trước khi lưu
        if(entity.getJsonMap()== null||entity.getJsonMap().isEmpty()) {
            String mapData = objectMapper.writeValueAsString(mapUtils.build(entity.getW(), entity.getH()));
            entity.setJsonMap(mapData);
        }
        return worldRepository.save(entity);
    }

    @Override
    public worldEntity update(Integer id, worldEntity newDetails) {
        Optional<worldEntity> exists = worldRepository.findById(id);
        if (exists.isPresent()) {
            exists.get().setTenMap(newDetails.getTenMap());
            exists.get().setCode(newDetails.getCode());
            exists.get().setJsonMap(newDetails.getJsonMap());
            exists.get().setW(newDetails.getW());
            exists.get().setH(newDetails.getH());
            if (newDetails.getJsonMap() == null || newDetails.getJsonMap().isEmpty()) {
                String mapData = objectMapper.writeValueAsString(mapUtils.build(newDetails.getW(), newDetails.getH()));
                exists.get().setJsonMap(mapData);
            }
            return worldRepository.save(exists.get());

        }
        throw new RuntimeException("Không tìm thấy Map với ID: " + id);
    }


    @Override
    public void delete(Integer id) {
        worldRepository.deleteById(id);
    }
}