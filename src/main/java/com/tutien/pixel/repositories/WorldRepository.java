package com.tutien.pixel.repositories;

import com.tutien.pixel.entities.worldEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface WorldRepository extends JpaRepository<worldEntity, Integer> {
    // Tìm kiếm theo code (vì code là unique)
    Optional<worldEntity> findByCode(String code);

}