package com.tutien.pixel.services;

import com.tutien.pixel.entities.worldEntity;
import com.tutien.pixel.repositories.WorldRepository;
import com.tutien.pixel.repositories.iRepositories.IGenericService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Optional;

@Service
public class WorldService implements IGenericService<worldEntity, Integer> {

    @Autowired
    private WorldRepository worldRepository;

    @Override
    public List<worldEntity> findAll() {
        return worldRepository.findAll();
    }

    @Override
    public Optional<worldEntity> findById(Integer id) {
        return worldRepository.findById(id);
    }

    @Override
    public worldEntity save(worldEntity entity) {
        // Đảm bảo quan hệ 2 chiều được thiết lập trước khi lưu
        return worldRepository.save(entity);
    }

    @Override
    public worldEntity update(Integer id, worldEntity newDetails) {
        return worldRepository.findById(id).map(world -> {
            world.setTenMap(newDetails.getTenMap());
            world.setCode(newDetails.getCode());
            world.setJsonMap(newDetails.getJsonMap());
            world.setW(newDetails.getW());
            world.setH(newDetails.getH());

            return worldRepository.save(world);
        }).orElseThrow(() -> new RuntimeException("Không tìm thấy Map với ID: " + id));
    }

    @Override
    public void delete(Integer id) {
        worldRepository.deleteById(id);
    }
}