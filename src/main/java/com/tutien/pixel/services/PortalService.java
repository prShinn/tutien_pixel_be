package com.tutien.pixel.services;

import com.tutien.pixel.entities.portalEntity;
import com.tutien.pixel.repositories.PortalRepository;
import com.tutien.pixel.repositories.iRepositories.IGenericService;
import com.tutien.pixel.utils.maps.MapUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

import java.util.List;
import java.util.Optional;

@Service
public class PortalService implements IGenericService<portalEntity, Integer> {

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

        return portalRepository.save(entity);
    }

    @Override
    public portalEntity update(Integer id, portalEntity newDetails) {
        Optional<portalEntity> exists = portalRepository.findById(id);
        if (exists.isPresent()) {
            exists.get().setCode(newDetails.getCode());
            exists.get().setDenMap(newDetails.getDenMap());


            return portalRepository.save(exists.get());

        }
        throw new RuntimeException("Không tìm thấy Map với ID: " + id);
    }


    @Override
    public void delete(Integer id) {
        portalRepository.deleteById(id);
    }
}
